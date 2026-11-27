package kz.drakkkkon.moelenta;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import javax.xml.parsers.DocumentBuilderFactory;
import org.json.JSONArray;
import org.json.JSONObject;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/** Разбор лент и отбор новых записей. Идентификаторы те же, что на сайте: guid или id, ссылка, заголовок. */
final class Feeds {
    static final String HUB = "hub:sites";

    static final class Item {
        final String id, title, link, text;
        Item(String id, String title, String link, String text) {
            this.id = id;
            this.title = title;
            this.link = link;
            this.text = text;
        }
    }

    static List<Item> parse(byte[] body, String url) throws Exception {
        List<Item> out = new ArrayList<>();
        if (url.equals(HUB)) {
            String s = new String(body, StandardCharsets.UTF_8);
            JSONArray programs = new JSONObject(s.substring(s.indexOf('{'), s.lastIndexOf('}') + 1)).getJSONArray("programs");
            for (int p = 0; p < programs.length(); p++) {
                JSONObject program = programs.getJSONObject(p);
                JSONArray versions = program.getJSONArray("versions");
                // новые версии стоят в начале списка
                for (int v = 0; v < Math.min(versions.length(), 3); v++) {
                    JSONObject ver = versions.getJSONObject(v);
                    out.add(new Item(program.getString("id") + "@" + ver.optString("v") + "@" + ver.optString("date"),
                            program.optString("name") + " " + ver.optString("v"),
                            "https://drakkkkon.github.io/maymani/" + program.optString("page"), ver.optString("name")));
                }
            }
            return out;
        }
        if (url.startsWith("https://api.github.com/")) {
            JSONArray list = new JSONArray(new String(body, StandardCharsets.UTF_8));
            for (int i = 0; i < list.length(); i++) {
                JSONObject r = list.getJSONObject(i);
                String link = r.optString("html_url");
                String name = r.isNull("name") ? "" : r.optString("name");
                out.add(new Item(link, name.isEmpty() ? r.optString("tag_name") : name, link, r.isNull("body") ? "" : r.optString("body")));
            }
            return out;
        }
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setExpandEntityReferences(false);
        // пробелы и пустые строки перед <?xml мешают разбору
        int start = 0;
        while (start < body.length && body[start] != '<') start++;
        if (start == body.length) throw new Exception("не лента");
        Element root = factory.newDocumentBuilder()
                .parse(new ByteArrayInputStream(body, start, body.length - start)).getDocumentElement();
        String kind = root.getNodeName().toLowerCase(Locale.ROOT);
        if (!kind.equals("rss") && !kind.equals("feed") && !kind.equals("rdf:rdf")) throw new Exception("не лента");
        NodeList nodes = root.getElementsByTagName(kind.equals("feed") ? "entry" : "item");
        for (int i = 0; i < Math.min(nodes.getLength(), 60); i++) {
            Element e = (Element) nodes.item(i);
            String link = "";
            for (Node c = e.getFirstChild(); c != null; c = c.getNextSibling()) {
                if (!(c instanceof Element) || !c.getNodeName().equalsIgnoreCase("link")) continue;
                Element l = (Element) c;
                String rel = l.getAttribute("rel");
                if (rel.isEmpty() || rel.equals("alternate")) {
                    link = l.hasAttribute("href") ? l.getAttribute("href") : l.getTextContent().trim();
                    break;
                }
            }
            String title = plain(child(e, "title"));
            String id = child(e, "guid", "id");
            if (id.isEmpty()) id = !link.isEmpty() ? link : title;
            String text = plain(child(e, "description", "summary", "content", "content:encoded"));
            out.add(new Item(id, title.isEmpty() ? "Новая запись" : title, link, text));
        }
        return out;
    }

    private static String child(Element e, String... names) {
        for (String name : names)
            for (Node c = e.getFirstChild(); c != null; c = c.getNextSibling())
                if (c instanceof Element && c.getNodeName().equalsIgnoreCase(name)) return c.getTextContent().trim();
        return "";
    }

    private static String plain(String s) {
        return s.replaceAll("<[^>]*>", " ").replace("&nbsp;", " ").replace("&quot;", "\"").replace("&amp;", "&")
                .replaceAll("\\s+", " ").trim();
    }

    private static boolean has(Item item, String words, boolean ifEmpty) {
        String hay = (item.title + " " + item.text).toLowerCase(Locale.ROOT);
        boolean any = false;
        for (String w : words.toLowerCase(Locale.ROOT).split(",")) {
            w = w.trim();
            if (w.isEmpty()) continue;
            any = true;
            if (hay.contains(w)) return true;
        }
        return !any && ifEmpty;
    }

    /**
     * Возвращает записи для уведомлений и дополняет seen.
     * Первая проверка ленты (first) только запоминает то, что уже есть.
     */
    static List<Item> pick(Set<String> seen, boolean first, List<Item> list, String words, String stop) {
        List<Item> fresh = new ArrayList<>();
        Set<String> now = new LinkedHashSet<>();
        for (Item i : list) {
            if (!first && !seen.contains(i.id) && !now.contains(i.id) && has(i, words, true) && !has(i, stop, false)) fresh.add(i);
            now.add(i.id);
        }
        for (String id : seen) {
            if (now.size() >= 200) break;
            now.add(id);
        }
        seen.clear();
        seen.addAll(now);
        return fresh;
    }
}
