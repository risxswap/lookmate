package cc.riskswap.lookmate.storage;
public class RecognitionFailure extends Exception {
    private final boolean uncertain;
    private final String code;
    public RecognitionFailure(String code,boolean uncertain){super(code);this.code=code;this.uncertain=uncertain;}
    public boolean uncertain(){return uncertain;}
    public String code(){return code;}
}
